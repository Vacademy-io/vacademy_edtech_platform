package vacademy.io.admin_core_service.features.domain_routing.enums;

import org.springframework.util.StringUtils;

/**
 * How a phone input on this portal chooses which country code to pre-select.
 *
 * <p>
 * Persisted as a plain string in
 * {@code institute_domain_routing.phone_country_geo_mode} and echoed to the
 * dashboards through domain routing, which apply it client-side. Null is
 * {@link #INSTITUTE_FIRST}.
 */
public enum PhoneCountryGeoMode {

    /**
     * The institute's configured preferred countries win. The visitor's own
     * country is used only when the institute has configured none. This is the
     * default because an institute that took the trouble to configure a list
     * meant it.
     */
    INSTITUTE_FIRST,

    /**
     * The visitor's own country is pre-selected when it can be detected; the
     * institute's configured list still orders the remainder of the picker.
     * For institutes whose forms are filled in from several countries.
     */
    GEO_FIRST,

    /**
     * The visitor is never consulted. The configured list — or the platform
     * default when there is none — decides, exactly as before this setting
     * existed.
     */
    INSTITUTE_ONLY;

    public static PhoneCountryGeoMode getDefault() {
        return INSTITUTE_FIRST;
    }

    /**
     * Parses a stored or submitted value, tolerating case and surrounding
     * whitespace. Anything unrecognised (including null and blank) falls back to
     * {@link #getDefault()} rather than throwing: this setting is cosmetic, and a
     * bad value must never be able to fail a white-label save or a public domain
     * resolve.
     */
    public static PhoneCountryGeoMode fromNullable(String raw) {
        if (!StringUtils.hasText(raw)) {
            return getDefault();
        }
        try {
            return PhoneCountryGeoMode.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ignored) {
            return getDefault();
        }
    }

    /**
     * Normalises a submitted value for storage. Returns null for "unset" so a
     * portal that never touched the setting keeps a null column rather than a
     * redundantly stamped default.
     */
    public static String normalizeForStorage(String raw) {
        if (!StringUtils.hasText(raw)) {
            return null;
        }
        return fromNullable(raw).name();
    }
}
