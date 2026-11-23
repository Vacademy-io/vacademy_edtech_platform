package vacademy.io.admin_core_service.features.commerce.returns.enums;

import java.util.Locale;

/** How the buyer asked for the return; staff create every return in Phase 1. */
public enum RequestedVia {
    PHONE,
    WHATSAPP,
    EMAIL,
    COUNTER,
    OTHER;

    /** The value of a typed text, or null when it is not one. */
    public static RequestedVia of(String value) {
        if (value == null) {
            return null;
        }
        String v = value.trim().toUpperCase(Locale.ROOT);
        for (RequestedVia item : values()) {
            if (item.name().equals(v)) {
                return item;
            }
        }
        return null;
    }
}
