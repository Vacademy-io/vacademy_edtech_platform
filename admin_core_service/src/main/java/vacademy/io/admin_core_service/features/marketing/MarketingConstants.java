package vacademy.io.admin_core_service.features.marketing;

import java.util.List;
import java.util.Set;

/**
 * String constants for the marketing feature (ad spend sync + social posting). Every status,
 * provider and platform stored in the V660 tables is a plain String column; these are the only
 * values the code writes.
 */
public final class MarketingConstants {

    private MarketingConstants() {
    }

    // ── OAuth providers (marketing_connection.provider) ──────────────────────
    public static final String PROVIDER_META_ADS = "META_ADS";
    public static final String PROVIDER_META_SOCIAL = "META_SOCIAL";
    public static final String PROVIDER_GOOGLE_ADS = "GOOGLE_ADS";
    public static final String PROVIDER_GOOGLE_BUSINESS = "GOOGLE_BUSINESS";
    public static final Set<String> PROVIDERS = Set.of(
            PROVIDER_META_ADS, PROVIDER_META_SOCIAL, PROVIDER_GOOGLE_ADS, PROVIDER_GOOGLE_BUSINESS);

    /** oauth_connect_state.vendor = VENDOR_PREFIX + provider (e.g. MKT_META_ADS). */
    public static final String VENDOR_PREFIX = "MKT_";

    // ── Generic statuses (connection / ad account / social account) ──────────
    public static final String STATUS_ACTIVE = "ACTIVE";
    public static final String STATUS_RECONNECT_NEEDED = "RECONNECT_NEEDED";
    public static final String STATUS_REVOKED = "REVOKED";
    public static final String STATUS_ERROR = "ERROR";
    public static final String STATUS_DISCONNECTED = "DISCONNECTED";

    // ── Ad account sync result (ad_account.last_sync_status) ─────────────────
    public static final String SYNC_STATUS_OK = "OK";
    public static final String SYNC_STATUS_FAILED = "FAILED";

    // ── Platforms ────────────────────────────────────────────────────────────
    /** Ad platforms (ad_account.platform, ad_spend_daily.platform). */
    public static final String PLATFORM_META = "META";
    public static final String PLATFORM_GOOGLE = "GOOGLE";
    /** Report-only platform key: Google campaigns whose channel is VIDEO. */
    public static final String PLATFORM_YOUTUBE = "YOUTUBE";
    /** Social platforms (social_account.platform, social_post_target.platform). */
    public static final String PLATFORM_FACEBOOK = "FACEBOOK";
    public static final String PLATFORM_INSTAGRAM = "INSTAGRAM";
    public static final String PLATFORM_GOOGLE_BUSINESS = "GOOGLE_BUSINESS";
    public static final String SOCIAL_PLATFORM_YOUTUBE = "YOUTUBE";
    public static final List<String> SOCIAL_PLATFORMS = List.of(
            PLATFORM_FACEBOOK, PLATFORM_INSTAGRAM, PLATFORM_GOOGLE_BUSINESS, SOCIAL_PLATFORM_YOUTUBE);

    /** ad_spend_daily.channel for every Meta row. */
    public static final String CHANNEL_META = "META";
    /** Google advertising_channel_type that the report counts as YouTube. */
    public static final String CHANNEL_GOOGLE_VIDEO = "VIDEO";

    // ── Social posts (social_post.status) ────────────────────────────────────
    public static final String POST_STATUS_DRAFT = "DRAFT";
    public static final String POST_STATUS_NEEDS_APPROVAL = "NEEDS_APPROVAL";
    public static final String POST_STATUS_SCHEDULED = "SCHEDULED";
    public static final String POST_STATUS_PUBLISHING = "PUBLISHING";
    public static final String POST_STATUS_POSTED = "POSTED";
    public static final String POST_STATUS_PARTIAL = "PARTIAL";
    public static final String POST_STATUS_FAILED = "FAILED";
    public static final String POST_STATUS_CANCELLED = "CANCELLED";

    // ── Social post source (social_post.source) ──────────────────────────────
    public static final String POST_SOURCE_MANUAL = "MANUAL";
    public static final String POST_SOURCE_AGENT = "AGENT";

    // ── Social post targets (social_post_target.status) ──────────────────────
    public static final String TARGET_STATUS_PENDING = "PENDING";
    public static final String TARGET_STATUS_PUBLISHING = "PUBLISHING";
    public static final String TARGET_STATUS_POSTED = "POSTED";
    public static final String TARGET_STATUS_FAILED = "FAILED";
    public static final String TARGET_STATUS_SKIPPED = "SKIPPED";

    // ── Media types (social_post.media_json[].type) ──────────────────────────
    public static final String MEDIA_TYPE_IMAGE = "IMAGE";
    public static final String MEDIA_TYPE_VIDEO = "VIDEO";

    // ── Connect options (OAuth account picker) ───────────────────────────────
    public static final String OPTION_KIND_AD_ACCOUNT = "AD_ACCOUNT";
    public static final String OPTION_KIND_MANAGER_ACCOUNT = "MANAGER_ACCOUNT";
    public static final String OPTION_KIND_FACEBOOK_PAGE = "FACEBOOK_PAGE";
    public static final String OPTION_KIND_INSTAGRAM = "INSTAGRAM";
    public static final String OPTION_KIND_GBP_LOCATION = "GBP_LOCATION";

    // ── oauth_connect_state.session_status values used by this feature ───────
    public static final String SESSION_PENDING = "PENDING";
    public static final String SESSION_AUTHORIZED = "AUTHORIZED";
    public static final String SESSION_CONSUMED = "CONSUMED";
    public static final String SESSION_EXPIRED = "EXPIRED";

    // ── Frontend landing paths after OAuth ───────────────────────────────────
    public static final String FRONTEND_PATH_ADS = "/audience-manager/ad-performance";
    public static final String FRONTEND_PATH_SOCIAL = "/audience-manager/social-posts";

    public static boolean isAdsProvider(String provider) {
        return PROVIDER_META_ADS.equals(provider) || PROVIDER_GOOGLE_ADS.equals(provider);
    }

    public static boolean isMetaProvider(String provider) {
        return provider != null && provider.startsWith("META_");
    }

    public static boolean isGoogleProvider(String provider) {
        return provider != null && provider.startsWith("GOOGLE_");
    }

    /** Ad platform (META / GOOGLE) an ads provider writes into ad_account.platform. */
    public static String adPlatformFor(String provider) {
        return PROVIDER_GOOGLE_ADS.equals(provider) ? PLATFORM_GOOGLE : PLATFORM_META;
    }

    public static String vendorFor(String provider) {
        return VENDOR_PREFIX + provider;
    }

    /** Provider encoded in an oauth_connect_state vendor, or null when it is not a marketing state. */
    public static String providerFromVendor(String vendor) {
        if (vendor == null || !vendor.startsWith(VENDOR_PREFIX)) return null;
        String provider = vendor.substring(VENDOR_PREFIX.length());
        return PROVIDERS.contains(provider) ? provider : null;
    }

    public static String frontendPathFor(String provider) {
        return PROVIDER_META_SOCIAL.equals(provider) || PROVIDER_GOOGLE_BUSINESS.equals(provider)
                ? FRONTEND_PATH_SOCIAL : FRONTEND_PATH_ADS;
    }
}
